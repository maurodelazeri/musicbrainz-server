package MusicBrainz::Server::Data::EntityAnnotation;
use Moose;
use namespace::autoclean;

use HTML::Entities qw( decode_entities );
use List::MoreUtils qw( uniq );

use MusicBrainz::Server::Constants qw( $EDITOR_MODBOT %ENTITIES );
use MusicBrainz::Server::Entity::Annotation;
use MusicBrainz::Server::Data::Utils qw(
    placeholders
    query_to_list_limited
    type_to_model
);

extends 'MusicBrainz::Server::Data::Entity';

has [qw( type table )] => (
    is => 'rw',
    isa => 'Str',
    required => 1
);

sub _table
{
    my $self = shift;
    return $self->table . ' ea
            JOIN annotation a ON ea.annotation=a.id';
}

sub _columns
{
    return 'id, editor AS editor_id, text, changelog,
            created AS creation_date';
}

sub _entity_class
{
    return 'MusicBrainz::Server::Entity::Annotation';
}

sub get_history
{
    my ($self, $id, $limit, $offset) = @_;
    my $query = 'SELECT ' . $self->_columns .
                ' FROM ' . $self->_table .
                ' WHERE ' . $self->type . ' = ?' .
                ' ORDER BY created DESC OFFSET ?';
    return query_to_list_limited(
        $self->c->sql, $offset, $limit, sub { $self->_new_from_row(@_) },
        $query, $id, $offset || 0
    );
}

sub _column_mapping {
    return {
        id => 'id',
        text => sub {
            my $row = shift;
            $row->{text} && decode_entities($row->{text});
        },
        changelog => 'changelog',
        editor_id => 'editor_id',
        creation_date => 'creation_date'
    }
}

sub get_latest
{
    my ($self, $id) = @_;
    my $query = "SELECT " . $self->_columns .
                " FROM " . $self->_table .
                " WHERE " . $self->type . " = ?" .
                " ORDER BY created DESC, id DESC LIMIT 1";
    my $row = $self->sql->select_single_row_hash($query, $id)
        or return undef;
    return $self->_new_from_row($row);
}

sub load_latest
{
    my ($self, @objs) = @_;
    for my $obj (@objs) {
        next unless $obj->does('MusicBrainz::Server::Entity::Role::Annotation');
        my $annotation = $self->get_latest($obj->id) or next;
        $obj->latest_annotation($annotation);
    }
}

sub edit
{
    my ($self, $annotation_hash) = @_;
    my $annotation_id = $self->sql->insert_row('annotation', {
        editor => $annotation_hash->{editor_id},
        text => $annotation_hash->{text},
        changelog => $annotation_hash->{changelog}
    }, 'id');
    $self->sql->insert_row($self->table, {
        $self->type => $annotation_hash->{entity_id},
        annotation => $annotation_id
    });
    return $annotation_id;
}

sub delete
{
    my ($self, @ids) = @_;
    my $query = "DELETE FROM " . $self->table .
                " WHERE " . $self->type . " IN (" . placeholders(@ids) . ")" .
                " RETURNING annotation";
    my $annotations = $self->sql->select_single_column_array($query, @ids);
    return 1 unless scalar @$annotations;
    $query = "DELETE FROM annotation WHERE id IN (" . placeholders(@$annotations) . ")";
    $self->sql->do($query, @$annotations);
    return 1;
}

sub merge
{
    my ($self, $new_id, @old_ids) = @_;
    my $table = $self->table;
    my $type = $self->type;

    my @ids = ($new_id, @old_ids);
    my %entity_to_annotation = map { @$_ } @{
        $self->sql->select_list_of_lists(
            "SELECT $type, text
             FROM (
                 SELECT $type, text, row_number() OVER (PARTITION BY $type ORDER BY created DESC)
                 FROM annotation
                 JOIN $table ent_annotation ON ent_annotation.annotation = annotation.id
                 WHERE $type IN (".placeholders(@ids).")
             ) s
             WHERE row_number = 1",
            @ids
        )
    };

    my $modbot = $self->c->model('Editor')->get_by_id($EDITOR_MODBOT);
    if (keys %entity_to_annotation > 1) {
        my $new_text = join("\n\n-------\n\n",
                            uniq
                            grep { $_ ne "" }
                            map { $entity_to_annotation{$_} // "" }
                            @ids);
        if ($new_text ne '') {
            $self->c->model('Edit')->create(
                edit_type => $ENTITIES{$type}{annotations}{edit_type},
                editor => $modbot,
                entity => $self->c->model(type_to_model($type))->get_by_id($new_id),
                text => $new_text,
                changelog => "Result of $type merge"
            );
        }
    }

    $self->sql->do("UPDATE $table SET $type = ?
              WHERE $type IN (".placeholders(@old_ids).")", $new_id, @old_ids);
}

no Moose;
__PACKAGE__->meta->make_immutable;
1;

=head1 NAME

MusicBrainz::Server::Data::Annotation

=head1 DESCRIPTION

Provides support for loading annotations from the database.

=head1 COPYRIGHT

Copyright (C) 2009 Lukas Lalinsky

This program is free software; you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation; either version 2 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program; if not, write to the Free Software
Foundation, Inc., 675 Mass Ave, Cambridge, MA 02139, USA.

=cut

